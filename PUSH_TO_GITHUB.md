# Push to GitHub - Quick Guide

Your repository is now initialized and ready to push to GitHub!

## Steps to Push to GitHub:

### 1. Create a New Repository on GitHub

1. Go to [GitHub.com](https://github.com) and sign in
2. Click the **"+"** icon in the top right → **"New repository"**
3. Enter a repository name (e.g., `werkstatt-verwaltung`)
4. Choose **Public** or **Private**
5. **DO NOT** initialize with README, .gitignore, or license (we already have these)
6. Click **"Create repository"**

### 2. Connect Your Local Repository to GitHub

After creating the repository, GitHub will show you commands. Use these commands in your terminal:

```bash
cd werkstatt-verwaltung

# Add the remote repository (replace YOUR_USERNAME and YOUR_REPO_NAME)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Rename branch to 'main' if needed (GitHub uses 'main' by default)
git branch -M main

# Push your code to GitHub
git push -u origin main
```

**Note:** If your repository is on the `master` branch and GitHub expects `main`, you can either:
- Use `git branch -M main` to rename your branch (recommended)
- Or push to `master`: `git push -u origin master`

### 3. Verify the Push

1. Refresh your GitHub repository page
2. You should see all your files there!

### 4. Enable GitHub Pages (After First Push)

1. Go to your repository on GitHub
2. Click **Settings** → **Pages**
3. Under **Source**, select **"GitHub Actions"**
4. Save the settings

The GitHub Actions workflow will automatically deploy your app when you push changes!

## Your App Will Be Available At:

After the first deployment completes:
- `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

## Important: Update Homepage in package.json

Before deploying, make sure the `homepage` field in `package.json` matches your repository name:

- If your repo is `werkstatt-verwaltung`, keep: `"homepage": "./"`
- If your repo has a different name, change to: `"homepage": "/YOUR_REPO_NAME/"`

Then commit and push:
```bash
git add package.json
git commit -m "Update homepage for GitHub Pages"
git push
```

## Future Updates

To push future changes:
```bash
git add .
git commit -m "Your commit message"
git push
```

The GitHub Actions workflow will automatically rebuild and deploy your app!

