export const createWindowQueue = () => {
  const tails = new Map()

  const enqueue = (windowId, task) => {
    const previous = tails.get(windowId) ?? Promise.resolve()
    const execution = previous.then(task, task)
    const tail = execution.then(
      () => undefined,
      () => undefined,
    )

    tails.set(windowId, tail)
    void tail.then(() => {
      if (tails.get(windowId) === tail) tails.delete(windowId)
    })

    return execution
  }

  return { enqueue }
}
