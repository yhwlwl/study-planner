import { afterEach } from 'vitest'
import { resetNowProvider } from '../src/lib/date'

afterEach(() => resetNowProvider())
