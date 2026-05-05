// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import ScanView     from '../views/ScanView.vue'
import TrackingView from '../views/TrackingView.vue'
import CartUnlockView  from '../views/CartUnlockView.vue'
import UserSessionView from '../views/UserSessionView.vue'
import AdminView    from '../views/AdminView.vue'
import AdminLoginView from '../views/AdminLoginView.vue'
import AdminCartSelectView from '../views/AdminCartSelectView.vue'
import { connectSocket } from '../api/socket'
import { clearAdminSession, getAdminSession } from '../api/adminAuth'
import { getAdminSelectedCart } from '../api/adminCartSelection'

const routes = [
  { path: '/',              component: ScanView },
  { path: '/tracking',      component: TrackingView },
  { path: '/cart/:cartId',  component: CartUnlockView },
  { path: '/session',       component: UserSessionView },
  { path: '/admin', component: AdminLoginView },
  { path: '/admin/login', redirect: '/admin' },
  { path: '/admin/select-cart', component: AdminCartSelectView, meta: { requiresAdmin: true } },
  { path: '/admin/dashboard/:cartId', component: AdminView, meta: { requiresAdmin: true } },
  {
    path: '/admin/dashboard',
    redirect: () => {
      const selectedCart = getAdminSelectedCart()
      return selectedCart ? `/admin/dashboard/${selectedCart}` : '/admin/select-cart'
    },
  },
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
        return '/admin/select-cart'
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