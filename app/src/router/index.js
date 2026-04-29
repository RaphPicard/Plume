// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import ScanView     from '../views/ScanView.vue'
import TrackingView from '../views/TrackingView.vue'
import AdminView    from '../views/AdminView.vue'
import AdminLoginView from '../views/AdminLoginView.vue'
import { connectSocket } from '../api/socket'
import { clearAdminSession, getAdminSession } from '../api/adminAuth'

const routes = [
  { path: '/',         component: ScanView },
  { path: '/tracking', component: TrackingView },
  { path: '/admin', component: AdminLoginView },
  { path: '/admin/login', redirect: '/admin' },
  { path: '/admin/dashboard', component: AdminView, meta: { requiresAdmin: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  if (to.path === '/admin') {
    const session = getAdminSession()
    if (session) {
      try {
        await connectSocket(session.token)
        return '/admin/dashboard'
      } catch {
        clearAdminSession()
      }
    }
    return true
  }

  if (to.meta.requiresAdmin) {
    const session = getAdminSession()
    if (!session) return '/admin'

    try {
      await connectSocket(session.token)
      return true
    } catch {
      clearAdminSession()
      return '/admin'
    }
  }

  return true
})

export default router