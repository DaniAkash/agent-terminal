import { RouterProvider } from '@tanstack/react-router'

import ReactDOM from 'react-dom/client'
import { router } from './router'
import './index.css'

// React.StrictMode is intentionally omitted. StrictMode double-invokes
// effects in development, which causes pty sessions to spawn twice and
// produces duplicate output / [Process exited] noise in the terminal.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <RouterProvider router={router} />,
)
