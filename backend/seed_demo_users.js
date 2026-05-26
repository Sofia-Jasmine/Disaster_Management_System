/**
 * seed_demo_users.js
 * Re-seeds the demo Users with bcrypt-hashed passwords.
 * Run once after Phase 2 migration: node seed_demo_users.js
 */

const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 10;

const DEMO_USERS = [
    { name: "Admin User",  email: "admin@demo.com", password: "admin",   role: "ADMIN" },
    { name: "FVO One",     email: "fvo1@demo.com",  password: "fvo123",  role: "FVO" },
    { name: "FVO Two",     email: "fvo2@demo.com",  password: "fvo123",  role: "FVO" },
    { name: "Regular User",email: "user1@demo.com", password: "user123", role: "USER" },
];

async function seed() {
    const db = await mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "root@123",
        database: "disaster_management"
    });

    console.log("Connected to MySQL. Seeding demo users with bcrypt passwords...\n");

    for (const u of DEMO_USERS) {
        const hashed = await bcrypt.hash(u.password, SALT_ROUNDS);
        try {
            // Try insert first
            await db.query(
                "INSERT INTO Users (name, email, username, password, role) VALUES (?, ?, ?, ?, ?)",
                [u.name, u.email, u.email, hashed, u.role]
            );
            console.log(`  ✅ Inserted: ${u.email}`);
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                // Already exists — update the password hash
                await db.query(
                    "UPDATE Users SET name = ?, password = ?, role = ? WHERE email = ?",
                    [u.name, hashed, u.role, u.email]
                );
                console.log(`  🔄 Updated:  ${u.email}`);
            } else {
                console.error(`  ❌ Error for ${u.email}:`, err.message);
            }
        }
    }

    await db.end();
    console.log("\n✅ Done! Demo users now have bcrypt-hashed passwords.");
}

seed().catch(console.error);
