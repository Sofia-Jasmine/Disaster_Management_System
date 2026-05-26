(async () => {
    try {
        const res = await fetch('http://localhost:5000/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'alex@demo.com', password: 'fvo123' })
        });
        const data = await res.json();
        console.log("Response:", data);
    } catch (err) {
        console.error("Error:", err);
    }
})();
