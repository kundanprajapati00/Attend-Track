const express = require("express");
const app = express();
const mysql = require("mysql2");
const path = require("path");
const ejsMate = require("ejs-mate");
const methodOverride = require("method-override");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const session = require("express-session");
const bcrypt = require("bcrypt");
require("dotenv").config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
});

// ----- middleware req.user has information about current login user

app.use((req, res, next) => {
  res.locals.currentUser = req.user; //  first we store it on locals so that we can access it on ejs page
  next();
});

// ---------- configure passport local stratgy --

passport.use(
  new LocalStrategy(async (username, password, done) => {
    let q = "SELECT * FROM users WHERE username = ?";

    connection.query(q, [username], async (err, result) => {
      if (err) return done(err);

      if (result.length === 0) {
        return done(null, false, { message: "User not found" });
      }

      const user = result[0];

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return done(null, false, { message: "Wrong password" });
      }

      return done(null, user); // if everything is correct user is authenticated Login success
    });
  }),
);

// serialize -> store user info in session same opposite in deserialize

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  let q = "SELECT * FROM users WHERE id = ?";

  connection.query(q, [id], (err, result) => {
    done(err, result[0]);
  });
});

// ----------- signup route --------

app.get("/signup", (req, res) => {
  res.render("pages/signup.ejs");
});

app.post("/signup", async (req, res) => {
  const { username, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    let q = "INSERT INTO users (username, password) VALUES (?, ?)";

    connection.query(q, [username, hashedPassword], (err, result) => {
      if (err) {
        console.log(err);

        if (err.code === "ER_DUP_ENTRY") {
          return res.send("Username already exists");
        }

        return res.send("Error creating user");
      }

      res.redirect("/login");
    });
  } catch (err) {
    console.log(err);
    res.send("Server error");
  }
});

//  ------- Login route --------

app.get("/login", (req, res) => {
  res.render("pages/login.ejs");
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  }),
);

// ------------ Logout route --------

app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/login");
  });
});

// ---------- user is login or not authorization --

function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
}

// home page ------------

app.get("/", (req, res) => {
  let q = `SELECT count(*)FROM students`;
  try {
    connection.query(q, (err, result) => {
      if (err) throw err;
      let count = result[0]["count(*)"];
      res.render("pages/home.ejs", { count });
    });
  } catch (err) {
    console.log(err);
    res.send("some error in db");
  }
});

// All students with filter  -----------------

app.get("/students", isLoggedIn, (req, res) => {
  let { dept, sem } = req.query;

  let q;
  let values = [];

  if (dept && sem) {
    //  Filter case -----
    q = `
      SELECT * FROM students 
      WHERE semester = ? AND department = ?
    `;
    values = [sem, dept];
  } else {
    //  Show all students
    q = `SELECT * FROM students`;
  }

  connection.query(q, values, (err, result) => {
    if (err) {
      console.log(err);
      return res.send("error");
    }

    res.render("pages/student.ejs", {
      students: result,
      semester: sem || "",
      department: dept || "",
    });
  });
});

// adding new students

app.get("/students/new", isLoggedIn, (req, res) => {
  res.render("pages/new.ejs");
});

app.post("/students/new", (req, res) => {
  let { name, department, email, semester, rollno } = req.body;
  let q = `INSERT INTO students(name,department,email,semester,roll_no) VALUES (?,?,?,?,?)`;
  let student = [name, department, email, semester, rollno];

  try {
    connection.query(q, student, (err, result) => {
      if (err) throw err;
      res.redirect("/students");
    });
  } catch (err) {
    console.log(err);
    res.send("Some error occured");
  }
});

//  Mark attendence

app.post("/attendance", (req, res) => {
  let { student_id, status } = req.body;

  let q = `
    INSERT INTO attendance (student_id, date, status)
    VALUES (?, CURDATE(), ?)
  `;

  connection.query(q, [student_id, status], (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        console.log("Attendance already marked");
      } else {
        console.log(err);
      }
    }
    res.redirect("/students");
  });
});

// -------- show route show student details ----------- with attendence

app.get("/students/:id", isLoggedIn, (req, res) => {
  let { id } = req.params;

  // 1. Get student details
  let studentQuery = `SELECT * FROM students WHERE student_id = ?`;

  connection.query(studentQuery, [id], (err, result) => {
    if (err) {
      console.log(err);
      return res.send("Error fetching student");
    }

    let student = result[0];

    // 2. Get attendance data
    let attendanceQuery = `
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present
      FROM attendance
      WHERE student_id = ?
    `;

    connection.query(attendanceQuery, [id], (err, attResult) => {
      if (err) {
        console.log(err);
        return res.send("Error fetching attendance");
      }

      let total = attResult[0].total;
      let present = attResult[0].present || 0;

      let percentage = total > 0 ? ((present / total) * 100).toFixed(2) : 0;

      // 3. Send everything to EJS
      res.render("pages/show.ejs", {
        student,
        total,
        present,
        percentage,
      });
    });
  });
});

// app.get("/students/:id", (req, res) => {
//   let { id } = req.params;

//   let q = `SELECT * FROM students WHERE student_id = ?`;

//   connection.query(q, [id], (err, result) => {
//     if (err) {
//       console.log(err);
//       return res.send("Error");
//     }
//     let student = result[0];
//     res.render("pages/show.ejs", { student });
//   });
// });

// Edit route  -------

app.get("/students/:id/edit", isLoggedIn, (req, res) => {
  let { id } = req.params;
  let q = `SELECT * FROM students WHERE student_id = ?`;

  try {
    connection.query(q, [id], (err, result) => {
      if (err) throw err;
      let student = result[0];
      res.render("pages/edit.ejs", { student });
    });
  } catch (err) {
    console.log(err);
  }
});

// update route details from edit form

app.patch("/students/:id", (req, res) => {
  let { id } = req.params;
  let { semester } = req.body;

  let q = `UPDATE students SET semester = ? WHERE student_id = ?`;

  connection.query(q, [semester, id], (err, result) => {
    if (err) {
      console.log(err);
      return res.send("Error updating student");
    }

    res.redirect("/students");
  });
});

// -------- Delete route ------

app.delete("/students/:id", isLoggedIn, (req, res) => {
  let { id } = req.params;
  let q = `DELETE FROM students WHERE student_id = ?`;

  connection.query(q, [id], (err, result) => {
    if (err) {
      console.log(err);
      return res.send("Error deleting student ");
    }
    res.redirect("/students");
  });
});

app.listen(3030, () => {
  console.log("server is listining on port 3030");
});
