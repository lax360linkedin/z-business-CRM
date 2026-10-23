import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme/personalization.css'
import './api/mockServer'
import App from './App.jsx'
import { installTruncationTitles } from './utils/truncationTitles'

installTruncationTitles()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
