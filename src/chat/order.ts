// 排序規則。兩個版本的聊天服務共用，結果必須一致。

import type { Member, Message } from './types'

/** 比先後：joinedAt 早的在前，一樣時比 clientId。同一個代號有兩個人時，排前面的留下 */
export function compareMembers(a: Member, b: Member): number {
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt ? -1 : 1
  return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0
}

/** 訊息排序：先看 createdAt，一樣時看 id */
export function compareMessages(a: Message, b: Message): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
