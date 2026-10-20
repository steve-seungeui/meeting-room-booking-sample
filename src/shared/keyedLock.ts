/**
 * 같은 키에 대한 비동기 작업을 한 번에 하나씩 실행한다. 키가 다르면 서로 기다리지 않는다.
 * 한 프로세스 안에서만 유효하므로, 서버를 여러 대 띄우면 저장소 수준의 제약이 따로 필요하다.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}
