const mysql = require("mysql2");

// MySQL connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "root@123",
    database: "disaster_management"
});

db.connect();

const email = 'alex@demo.com';
const password = 'fvo123';

const sql = "SELECT * FROM Users WHERE email = ? AND password = ?";
db.query(sql, [email, password], (err, results) => {
    if (err) {
        console.error(err);
    } else {
        console.log("Results with binding:", results);
    }

    // Try without binding
    const sql2 = `SELECT * FROM Users WHERE email = '${email}' AND password = '${password}'`;
    db.query(sql2, (err, results2) => {
        if (err) {
            console.error(err);
        } else {
            console.log("Results raw string:", results2);
        }
        db.end();
    });
});
