import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './glassMotion.css'
import './chatLayout.css'
import './chunui-web.css'
import './ios-adaptation.css'
import './memory-redesign.css'
import './theme-light.css'
import './chunui-refinement.css'
import './theme-chat-light.css'
import './light-audit.css'
import './reply-mode-polish.css'
import './tools-theme.css'
import './tools-photo-theme.css'
import './theme'
import './nativeKeyboard'
import { ensureDefaultExtensionsInstalled } from './defaultExtensions'

try { ensureDefaultExtensionsInstalled() } catch { /* Home exposes a retryable storage notice. */ }

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
