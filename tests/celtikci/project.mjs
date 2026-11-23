export default {
  repoDir: 'celtikci-law-firm',
  previewPort: 4173,
  liveUrl: 'https://celtikci.av.tr',
  // Replaces real packages in unit tests, so no email can be sent.
  unitMocks: {
    nodemailer: 'tests/celtikci/mocks/nodemailer.mjs',
  },
};
