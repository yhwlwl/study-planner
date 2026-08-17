type UpdateListener = (available: boolean) => void

let updateAvailable = false
let applyUpdate: ((reload?: boolean) => Promise<void>) | undefined
const listeners = new Set<UpdateListener>()

export function configurePwaUpdater(updater: (reload?: boolean) => Promise<void>) {
  applyUpdate = updater
}

export function announcePwaUpdate() {
  updateAvailable = true
  listeners.forEach(listener => listener(true))
}

export function subscribePwaUpdate(listener: UpdateListener) {
  listeners.add(listener)
  listener(updateAvailable)
  return () => listeners.delete(listener)
}

export async function installPwaUpdate() {
  await applyUpdate?.(true)
}

export function deferPwaUpdate() {
  updateAvailable = false
  listeners.forEach(listener => listener(false))
}
