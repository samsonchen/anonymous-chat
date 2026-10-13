export function SystemNotice({ notice, nickname }: { notice: 'join' | 'leave'; nickname: string }) {
  return (
    <div className="notice">
      {nickname} {notice === 'join' ? '進來了' : '離開了'}
    </div>
  )
}
