import React, { useState, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthContext, type AuthContextType } from "../../context/AuthProvider";
import BackButton from "../../assets/BackButton.svg";
import styles from "./Login.module.css";

const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useContext(AuthContext) as AuthContextType;
  const navigate = useNavigate();

  const SubmitHandler = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(""); setIsLoading(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        setEmail(""); setPassword("");
        if (result.user?.role === "admin") { navigate("/admin-dashboard"); } else { navigate("/employee-dashboard"); }
      } else { setError(result.error || "Login failed"); }
    } catch (err) { console.error("Login error:", err); setError("An unexpected error occurred. Please try again."); }
    finally { setIsLoading(false); }
  };

  return (
    <div className={styles.container}>
      <div className={styles.formBox}>
        <form onSubmit={SubmitHandler} className={styles.form}>
          <Link to={"/"}><div className={styles.backButton}>
            <img src={BackButton} alt="BackButton" className={styles.backButtonImg} /></div></Link>
          {error && (<div className={styles.errorBox}>{error}</div>)}
          <input value={email} required onChange={(e) => setEmail(e.target.value)} disabled={isLoading}
            className={styles.input}
            type="email" placeholder="Enter your Email" />
          <input value={password} required onChange={(e) => setPassword(e.target.value)} disabled={isLoading}
            className={styles.input}
            type="password" placeholder="Enter your password" />
          <button type="submit" disabled={isLoading}
            className={styles.submitButton}>
            {isLoading ? "Logging in..." : "Log in"}
          </button>
          <div className={styles.divider}>
            <Link to="/signup"><div className={styles.dividerText}>
              New to WorkWave? <br /> Sign Up Here</div></Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;
