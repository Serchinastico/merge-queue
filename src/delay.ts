export const delay = async (milliseconds: number) => {
  return new Promise((resolve) => {
    if (!isNaN(milliseconds)) {
      setTimeout(() => resolve(), milliseconds)
    }
  })
}
