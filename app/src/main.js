// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'    // état global
import router from './router'           // navigation
import App from './App.vue'

const app = createApp(App)

app.use(createPinia())   // brancher Pinia
app.use(router)          // brancher le router

app.mount('#app')        // injecter Vue dans index.html
