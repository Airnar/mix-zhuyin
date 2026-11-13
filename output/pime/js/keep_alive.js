// The settings server quits after two minutes without a request. Ping it
// while a page is open, so changes made later still save.
setInterval(() => {
  const xhttp = new XMLHttpRequest();
  xhttp.open("GET", "/keep_alive");
  xhttp.send();
}, 30 * 1000);
