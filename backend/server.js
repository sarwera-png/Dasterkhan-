const path = require('path');
const express = require('express');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
