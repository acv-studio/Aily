import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

// Existing regression scenarios intentionally exercise the Chinese interface.
Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
