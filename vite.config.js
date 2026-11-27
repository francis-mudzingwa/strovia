import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Every build gets an id, built into the app and also published as /version.json. The app compares the two to tell people
// when a newer version is available (see src/UpdateBanner.jsx).
const BUILD_ID = String(Date.now())

function versionFile() {
  return {
    name: 'strovia-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
