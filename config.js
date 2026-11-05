// =====================================================================
// config.js: deployment settings. Fill in after following SETUP.md.
// Nothing secret goes here: this file is public on GitHub Pages.
// The study access code travels in each participant's link (?code=...).
// =====================================================================

window.CONFIG = {
  // URL of your Cloudflare Worker, without trailing slash (SETUP.md step 3)
  WORKER_URL: "https://markov-teach-back.YOUR-SUBDOMAIN.workers.dev",

  // Optional: links to your Google Forms (leave "" to hide the buttons)
  PRETEST_URL: "",
  POSTTEST_URL: "",

  // Shown on the consent screen
  CONTACT: "Tim Harreither, Krishna Pranathi Naidu, Zoi Koukouve"
};
