# Hidden Gem Deal Terminal

This is a professional Real Estate Underwriting and Negotiation tool built with React, Vite, and Tailwind CSS. It is designed to analyze "Hidden Gem" properties in the Inland Empire and provide strategic negotiation playbooks.

## 🚀 Quick Start (Local Development)

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Run Development Server**:
   ```bash
   npm run dev
   ```
3. **Build for Production**:
   ```bash
   npm run build
   ```

## 🌐 Deploying to Vercel

1. **Push to GitHub**: Initialize a git repo and push your code to a GitHub repository.
2. **Import to Vercel**:
   - Log in to [vercel.com](https://vercel.com).
   - Click **New Project**.
   - Select your GitHub repository.
   - Vercel will auto-detect the Vite configuration.
3. **Environment Variables**:
   - If you use the Gemini AI features externally, add your `GEMINI_API_KEY` in the Vercel Project Settings under "Environment Variables".

## 📊 Data Storage & Analysis

To move beyond local state and enable long-term data analysis:
- **Database**: The app is designed to be compatible with **Firebase Firestore**.
- **Setup**: 
  1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
  2. Copy your `firebaseConfig` object.
  3. Create a `.env` file in the root directory and add your keys.
- **Analysis**: By storing deals in Firestore, you can connect the data to tools like **Google Looker Studio** or **PowerBI** for portfolio-wide analysis.

## 🛠 Tech Stack
- **Framework**: React 18 (Vite)
- **Styling**: Tailwind CSS + Shadcn/UI
- **Icons**: Lucide React
- **Animations**: Framer Motion
- **Markdown**: React Markdown (for deep analysis reports)
