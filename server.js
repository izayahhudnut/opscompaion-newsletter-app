const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/signup", (req, res) => {
  const { email } = req.body;

  if (!email) {
    console.error("newsletter_signup_failed", {
      body: req.body,
      error: "email is required"
    });

    return res.status(400).json({
      error: "email is required"
    });
  }

  return res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Newsletter demo listening on http://localhost:${port}`);
});
