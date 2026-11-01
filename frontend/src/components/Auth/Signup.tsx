import React, { useState, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthContext, type AuthContextType } from "../../context/AuthProvider";
import BackButton from "../../assets/BackButton.svg";
import type { UserRole } from "../../types";
import styles from "./Signup.module.css";

const Signup: React.FC = () => {
  const [firstname, setFirstname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("employee");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { register } = useContext(AuthContext) as AuthContextType;
  const navigate = useNavigate();

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(""); setIsLoading(true);
    if (password.length < 6) { setError("Password must be at least 6 characters long"); setIsLoading(false); return; }
    try {
      const result = await register(email, password, firstname, role);
      if (result.success) {
        setFirstname(""); setEmail(""); setPassword("");
        alert("Signup successful! Welcome to WorkWave!");
        if (result.user?.role === "admin") { navigate("/admin-dashboard"); } else { navigate("/employee-dashboard"); }
      } else { setError(result.error || "Signup failed"); }
    } catch (err) { console.error("Signup error:", err); setError("An unexpected error occurred. Please try again."); }
    finally { setIsLoading(false); }
  };

  return (
    <div className={styles.container}>
      <div className={styles.formBox}>
        <form onSubmit={handleSignup} className={styles.form}>
          <Link to={"/"}><div className={styles.backButton}>
            <img src={BackButton} alt="BackButton" className={styles.backButtonImg} /></div></Link>
          {error && (<div className={styles.errorBox}>{error}</div>)}
          <div className={styles.roleSelector}>
            <button type="button" onClick={() => setRole("employee")} disabled={isLoading}
              className={`${styles.roleButton} ${role === "employee" ? styles.roleButtonActive : ""}`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={role === "employee" ? "#cec0ad" : "#9c815a"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={styles.roleIcon}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              <span className={`${styles.roleLabel} ${role === "employee" ? styles.roleLabelActive : styles.roleLabelInactive}`}>Employee</span>
            </button>
            <button type="button" onClick={() => setRole("admin")} disabled={isLoading}
              className={`${styles.roleButton} ${role === "admin" ? styles.roleButtonActive : ""}`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={role === "admin" ? "#cec0ad" : "#9c815a"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={styles.roleIcon}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 8l1.5 3 3.5.5-2.5 2.5.5 3.5L12 16l-3 1.5.5-3.5L7 11.5l3.5-.5z" />
              </svg>
              <span className={`${styles.roleLabel} ${role === "admin" ? styles.roleLabelActive : styles.roleLabelInactive}`}>Admin</span>
            </button>
          </div>
          <input value={firstname} required onChange={(e) => setFirstname(e.target.value)} disabled={isLoading}
            className={styles.input}
            type="text" placeholder="Enter your Name" />
          <input value={email} required onChange={(e) => setEmail(e.target.value)} disabled={isLoading}
            className={styles.input}
            type="email" placeholder="Enter your Email" />
          <input value={password} required onChange={(e) => setPassword(e.target.value)} disabled={isLoading}
            className={styles.input}
            type="password" placeholder="Enter your password (min 6 characters)" />
          <button type="submit" disabled={isLoading}
            className={styles.submitButton}>
            {isLoading ? "Creating Account..." : `Signup as ${role === "admin" ? "Admin" : "Employee"}`}
          </button>
          <div className={styles.divider}>
            <Link to={"/login"}><div className={styles.dividerText}>
              Already a user? <br /> Login Here</div></Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Signup;
