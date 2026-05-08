// api/listings.js — just redirect to the static file
module.exports = async function handler(req, res) {
  res.redirect(302, '/listings.json');
};
