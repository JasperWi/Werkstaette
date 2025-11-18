# GitHub Pages Deployment Guide

This guide will help you deploy your Werkstatt-Verwaltung application to GitHub Pages.

## Prerequisites

1. A GitHub account
2. Your project pushed to a GitHub repository
3. Node.js and npm installed locally (for manual deployment)

## Option 1: Automatic Deployment with GitHub Actions (Recommended)

This is the easiest method. The workflow will automatically deploy your app whenever you push to the `main` or `master` branch.

### Setup Steps:

1. **Push your code to GitHub** (if you haven't already):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```

2. **Enable GitHub Pages in your repository**:
   - Go to your repository on GitHub
   - Click on **Settings** → **Pages**
   - Under **Source**, select **GitHub Actions** (not "Deploy from a branch")
   - Save the settings

3. **Update the homepage in package.json** (if needed):
   - If your repository is named `werkstatt-verwaltung`, the current `"homepage": "./"` should work
   - If your repository has a different name, update it to: `"homepage": "/YOUR_REPO_NAME/"`
   - For example, if your repo is `my-workshop-app`, change it to: `"homepage": "/my-workshop-app/"`

4. **Push your changes**:
   ```bash
   git add .
   git commit -m "Add GitHub Pages deployment"
   git push
   ```

5. **Wait for deployment**:
   - Go to the **Actions** tab in your GitHub repository
   - You should see a workflow running called "Deploy to GitHub Pages"
   - Once it completes, your app will be live at: `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

## Option 2: Manual Deployment

If you prefer to deploy manually:

1. **Install dependencies** (if you haven't already):
   ```bash
   cd werkstatt-verwaltung
   npm install
   ```

2. **Update homepage in package.json**:
   - Change `"homepage": "./"` to `"homepage": "/YOUR_REPO_NAME/"`
   - Replace `YOUR_REPO_NAME` with your actual repository name

3. **Deploy**:
   ```bash
   npm run deploy
   ```

4. **Enable GitHub Pages**:
   - Go to your repository on GitHub
   - Click on **Settings** → **Pages**
   - Under **Source**, select the `gh-pages` branch
   - Select the `/ (root)` folder
   - Click **Save**

5. **Your app will be available at**:
   `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

## Important Notes

- **Repository Name**: Make sure to update the `homepage` field in `package.json` to match your repository name if it's different from `werkstatt-verwaltung`
- **Branch Name**: The GitHub Actions workflow is set to trigger on `main` or `master` branch. If you use a different branch name, update the workflow file (`.github/workflows/deploy.yml`)
- **Build Folder**: The deployment uses the `build` folder created by `npm run build`
- **Local Storage**: Note that the app uses browser LocalStorage, which means data is stored locally in each user's browser and won't be shared across devices

## Troubleshooting

### App shows blank page
- Check that the `homepage` field in `package.json` matches your repository name
- Make sure all assets are loading correctly (check browser console for 404 errors)
- Verify the build completed successfully

### GitHub Actions workflow fails
- Check the Actions tab for error messages
- Ensure Node.js version is compatible (the workflow uses Node 18)
- Verify all dependencies are listed in `package.json`

### Changes not appearing
- Clear your browser cache
- Wait a few minutes for GitHub Pages to update (can take up to 10 minutes)
- Check that the deployment workflow completed successfully

## Custom Domain (Optional)

If you want to use a custom domain:

1. Add a `CNAME` file to the `public` folder with your domain name
2. Configure your DNS settings as per GitHub Pages documentation
3. Update the `homepage` field in `package.json` to your custom domain

## Need Help?

- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Create React App Deployment Guide](https://create-react-app.dev/docs/deployment/#github-pages)

