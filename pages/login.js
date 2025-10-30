import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useRouter } from "next/router";

export default function Login() {
  const [email, setEmail] = useState("deemajor230600@gmail.com");
  const [password, setPassword] = useState("123456789");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const API_BASE_URL = `https://${process.env.NEXT_PUBLIC_BASE_URL}`;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      const idToken = await user.getIdToken();

      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idToken: idToken,
          role: "user",
        }),
        credentials: "include",
      });

      console.log("Backend response status:", response.status);

      if (!response.ok) {
        let errorMessage = `Server error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch (parseError) {
          const text = await response.text();
          if (text) {
            errorMessage = `Server returned: ${text.substring(0, 100)}`;
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Redirect to home page
      router.push("/");
    } catch (error) {
      console.error("Login error:", error);

      if (auth.currentUser) {
        await auth.signOut();
      }

      if (error.code && error.code.startsWith("auth/")) {
        switch (error.code) {
          case "auth/invalid-credential":
          case "auth/user-not-found":
          case "auth/wrong-password":
            setError(
              "Invalid email or password. Please check your credentials."
            );
            break;
          case "auth/invalid-email":
            setError("Invalid email address format.");
            break;
          case "auth/user-disabled":
            setError("This account has been disabled.");
            break;
          case "auth/too-many-requests":
            setError("Too many failed attempts. Please try again later.");
            break;
          default:
            setError("Firebase authentication failed. Please try again.");
        }
      } else {
        setError(error.message || "Login failed. Please try again.");

        if (
          error.message.includes("Failed to fetch") ||
          error.message.includes("NetworkError")
        ) {
          setError(
            "Cannot connect to backend server. Please check if the server is running and CORS is configured."
          );
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Backend: {API_BASE_URL}
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <input
                type="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <input
                type="password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
