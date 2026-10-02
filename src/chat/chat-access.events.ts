import { Injectable, Module } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

/**
 * In-process signal "these players' chat access may have changed" (became or
 * stopped being an active-team captain, got or lost an admin role). Writers
 * — `TeamsService`, `AdminService` — only depend on this dependency-free
 * module; `ChatGateway` subscribes and re-joins the players' sockets to the
 * right rooms. Lives in api-v1 together with the sockets, so no event bus.
 */
@Injectable()
export class ChatAccessEvents {
  private readonly subject = new Subject<string[]>();

  get changes(): Observable<string[]> {
    return this.subject.asObservable();
  }

  changed(playerIds: (string | null | undefined)[]): void {
    const ids = playerIds.filter((id): id is string => !!id);
    if (ids.length) this.subject.next(ids);
  }
}

@Module({
  providers: [ChatAccessEvents],
  exports: [ChatAccessEvents],
})
export class ChatEventsModule {}
