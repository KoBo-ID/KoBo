if (!process.env.BASE_URL) {
  console.error('e2e:postdeploy needs BASE_URL, e.g. BASE_URL=https://kobo.example npm run e2e:postdeploy')
  process.exit(1)
}
