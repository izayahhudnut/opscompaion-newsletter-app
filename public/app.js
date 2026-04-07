const form = document.getElementById("signup-form");
const emailInput = document.getElementById("email");
const message = document.getElementById("message");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  message.textContent = "Submitting...";
  message.className = "";

  try {
    const response = await fetch("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userEmail: email
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Something went wrong");
    }

    message.textContent = "Signup successful";
    message.className = "success";
    form.reset();
  } catch (error) {
    message.textContent = error.message;
    message.className = "error";
  }
});
