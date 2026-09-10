document.querySelector(".add-btn").addEventListener("click", () => {
  const slot = document.createElement("div");
  slot.className = "molecule-slot";
  document.getElementById("edukte-row").appendChild(slot);
});
