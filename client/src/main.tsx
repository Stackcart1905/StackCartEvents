import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import stackCartLogo from './assets/Stacklogo.jpg.jpeg'
import './styles.css'

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') || document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/jpeg'
favicon.href = stackCartLogo
document.head.append(favicon)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
