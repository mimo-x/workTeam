export interface EventPublisher {
  publishToUser(userId: string, event: Record<string, unknown>): void;
  publishToDevice(userId: string, deviceId: string, event: Record<string, unknown>): boolean;
  publishToRoom(roomId: string, event: Record<string, unknown>): Promise<void>;
  dispatchQueued(userId: string): Promise<void>;
}

export class NullEventPublisher implements EventPublisher {
  publishToUser() {}
  publishToDevice() {
    return false;
  }
  async publishToRoom() {}
  async dispatchQueued() {}
}
