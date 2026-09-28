// Tests de bout en bout (npm run test:e2e) sur les critères de validation.
// - projet « local » : build sans Supabase, service worker actif (hors ligne) ;
// - projet « remote » : build branché sur un faux Supabase simulé par les
//   tests (REST, RPC, Realtime), service worker désactivé ;
// - projet « login » : même build, écran de connexion (email, Google).
import { defineConfig } from '@playwright/test'

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  // En CI : pas de test.only oublié, annotations GitHub sur les échecs.
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-FR',
    timezoneId: 'Indian/Mauritius',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'local', testMatch: /local\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4173' } },
    { name: 'remote', testMatch: /remote\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4174', serviceWorkers: 'block' } },
    { name: 'remote-sw', testMatch: /remote-sw\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4174', serviceWorkers: 'allow' } },
    { name: 'login', testMatch: /login\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4174', serviceWorkers: 'block' } },
  ],
  webServer: [
    {
      command: 'vite build --outDir dist-e2e/local && vite preview --outDir dist-e2e/local --port 4173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      timeout: 120_000,
      reuseExistingServer: false,
      // Variables vides : force le mode local même si un .env existe.
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_SUPABASE_ANON_KEY: '' },
    },
    {
      command: 'vite build --outDir dist-e2e/remote && vite preview --outDir dist-e2e/remote --port 4174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4174',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_SUPABASE_URL: 'http://supabase.e2e', VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-key', VITE_SUPABASE_ANON_KEY: '' },
    },
  ],
})
