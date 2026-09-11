export type OpenImLifecycleSdk = {
  logout: () => Promise<unknown>;
  unInitSDK: () => Promise<unknown>;
};

export const closeOpenImSdk = async (sdk: OpenImLifecycleSdk) => {
  await sdk.logout().catch(() => undefined);
  await sdk.unInitSDK().catch(() => undefined);
};

export class OpenImLifecycleQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>) {
    const current = this.tail.then(operation, operation);
    this.tail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }
}
