export interface EventPublisher {
  publishToUser(userId: string, event: Record<string, unknown>): void;
  publishToRoom(roomId: string, event: Record<string, unknown>): Promise<void>;
  dispatchQueued(userId: string): Promise<void>;
}

export class NullEventPublisher implements EventPublisher {
  publishToUser() {}
  async publishToRoom() {}
  async dispatchQueued() {}
}
