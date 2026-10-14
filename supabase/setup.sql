-- 匿名聊天室：階段二的資料庫設定
--
-- 用法：Supabase 後台 → SQL Editor → New query → 整份貼上 → Run。
-- 可以重複執行，不會刪掉已經存在的訊息。
-- 這份檔案不含任何金鑰，可以放進 git。
--
-- 前提：已經在 Integrations → Cron 啟用 pg_cron（最後一段清除工作需要它）。


-- ───────────────────────────────────────────────────────────
-- 1. messages 表：存歷史訊息
-- ───────────────────────────────────────────────────────────
-- 長度用 char_length 算，單位是「字」，和網頁上的計算方式一致。
-- 這些規則是給「繞過網頁、直接對資料庫送資料」的人看的，網頁自己也會先檢查。

create table if not exists public.messages (
  id         uuid primary key,
  nickname   text not null,
  content    text not null,
  created_at timestamptz not null default now(),

  -- 代號：1–12 字、不能只有空白、不能有換行或 Tab、不能有看不見的字元、不能冒用系統
  constraint messages_nickname_length check (char_length(nickname) between 1 and 12),
  constraint messages_nickname_not_blank check (nickname ~ '\S'),
  constraint messages_nickname_one_line check (
    position(chr(10) in nickname) = 0 and position(chr(9) in nickname) = 0
  ),
  constraint messages_nickname_visible check (
    nickname !~ (
      '[' || chr(1) || '-' || chr(8) || chr(11) || '-' || chr(31) || chr(127) || '-' || chr(159)
      || chr(173) || chr(8203) || chr(8206) || '-' || chr(8207) || chr(8232) || '-' || chr(8238)
      || chr(8288) || '-' || chr(8303) || chr(65279) || chr(65529) || '-' || chr(65531) || ']'
    )
  ),
  constraint messages_nickname_not_reserved check (lower(nickname) not in ('系統', 'system')),

  -- 內容：1–500 字、不能只有空白、可以換行、不能有看不見的字元
  constraint messages_content_length check (char_length(content) between 1 and 500),
  constraint messages_content_not_blank check (content ~ '\S'),
  constraint messages_content_visible check (
    content !~ (
      '[' || chr(1) || '-' || chr(8) || chr(11) || '-' || chr(31) || chr(127) || '-' || chr(159)
      || chr(173) || chr(8203) || chr(8206) || '-' || chr(8207) || chr(8232) || '-' || chr(8238)
      || chr(8288) || '-' || chr(8303) || chr(65279) || chr(65529) || '-' || chr(65531) || ']'
    )
  )
);

-- 取最近 100 則、清除舊訊息、檢查頻率，都會用到時間排序
create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

create index if not exists messages_nickname_time_idx
  on public.messages (lower(nickname), created_at desc);


-- ───────────────────────────────────────────────────────────
-- 2. 誰能做什麼（RLS：列級安全）
-- ───────────────────────────────────────────────────────────
-- 沒有登入的人，在 Supabase 裡的身分叫 anon。
--   讀取：可以，全部都能讀
--   新增：可以，但只能填 id、nickname、content；created_at 由資料庫自己填
--   修改、刪除：沒有人可以（清除工作是用管理權限執行，不受這裡限制）

alter table public.messages enable row level security;

revoke all on table public.messages from anon, authenticated;
grant select on table public.messages to anon;
grant insert (id, nickname, content) on table public.messages to anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_select_all'
  ) then
    create policy messages_select_all on public.messages
      for select to anon
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_insert_all'
  ) then
    create policy messages_insert_all on public.messages
      for insert to anon
      with check (true);
  end if;
end
$$;


-- ───────────────────────────────────────────────────────────
-- 3. 防洗版：同一個代號 1 秒內不能新增第二則
-- ───────────────────────────────────────────────────────────
-- 擋得住同一個代號的連發，擋不住有人換很多個代號（見 docs/architecture.md 9.2）。

create or replace function public.messages_rate_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1 from public.messages
    where lower(nickname) = lower(new.nickname)
      and created_at > now() - interval '1 second'
  ) then
    raise exception 'RATE_LIMITED' using hint = 'Same nickname can send one message per second.';
  end if;
  return new;
end;
$$;

-- 這個函式只給觸發器用，不開放別人直接呼叫
revoke execute on function public.messages_rate_limit() from public, anon, authenticated;

create or replace trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.messages_rate_limit();


-- ───────────────────────────────────────────────────────────
-- 4. 即時通知：新訊息要推給所有人
-- ───────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;


-- ───────────────────────────────────────────────────────────
-- 5. 每天自動清掉超過 7 天的訊息
-- ───────────────────────────────────────────────────────────
-- 排程用 UTC 計算：19:00 UTC = 台灣時間每天凌晨 3:00。
-- 同名的工作再執行一次，會取代舊的，不會變成兩個。
-- 要改保留天數，改下面的 '7 days'。

select cron.schedule(
  'messages-cleanup',
  '0 19 * * *',
  $job$ delete from public.messages where created_at < now() - interval '7 days' $job$
);


-- ───────────────────────────────────────────────────────────
-- 6. 檢查結果（執行完會在下方列出一張表，每一列的結果都應該是 true 或有排程時間）
-- ───────────────────────────────────────────────────────────

select '資料表存在' as 檢查項目,
       (to_regclass('public.messages') is not null)::text as 結果
union all
select 'RLS 已開啟',
       coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.messages')), 'false')
union all
select '有 2 條規則（讀取、新增）',
       ((select count(*) from pg_policies where schemaname = 'public' and tablename = 'messages') = 2)::text
union all
select '頻率限制已設定',
       exists (select 1 from pg_trigger where tgname = 'messages_rate_limit' and not tgisinternal)::text
union all
select '已加入即時通知',
       exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
       )::text
union all
select '清除工作的排程（UTC）',
       coalesce((select schedule from cron.job where jobname = 'messages-cleanup'), '沒有找到')
union all
select 'anon 能讀取',
       has_table_privilege('anon', 'public.messages', 'select')::text
union all
select 'anon 不能修改、刪除',
       (not has_table_privilege('anon', 'public.messages', 'update')
        and not has_table_privilege('anon', 'public.messages', 'delete'))::text;
