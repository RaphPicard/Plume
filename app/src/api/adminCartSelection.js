// src/api/adminCartSelection.js
const ADMIN_CART_KEY = 'admin_selected_cart'

export function saveAdminSelectedCart(cartId) {
  localStorage.setItem(ADMIN_CART_KEY, cartId)
}

export function getAdminSelectedCart() {
  return localStorage.getItem(ADMIN_CART_KEY)
}

export function clearAdminSelectedCart() {
  localStorage.removeItem(ADMIN_CART_KEY)
}
