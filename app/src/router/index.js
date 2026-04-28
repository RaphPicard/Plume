// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import ScanView     from '../views/ScanView.vue'
import TrackingView from '../views/TrackingView.vue'
import AdminView    from '../views/AdminView.vue'

const routes = [
  { path: '/',         component: ScanView },
  { path: '/tracking', component: TrackingView },
  { path: '/admin',    component: AdminView },
]

export default createRouter({
  history: createWebHistory(),
  routes
})