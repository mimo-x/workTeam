type Cleanup = () => void | Promise<void>;

export class ShutdownCoordinator {
  private pending: Promise<void> | null = null;

  run(cleanups: Cleanup[]) {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch (error) {
          // 退出阶段继续释放其余资源，同时保留原始错误便于排查。
          console.error("退出清理失败：", error);
        }
      }
    })();
    return this.pending;
  }
}
