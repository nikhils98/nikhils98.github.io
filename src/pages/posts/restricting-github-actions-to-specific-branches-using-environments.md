---
layout: ../../layouts/PostLayout.astro
title: Restricting Github Actions To Specific Branches Using Environments
date: 2022-09-27 12:16
tags: ["github-actions"]
---

_This post was originally posted on my older blog based on [Ghost][ghost]_

I wanted to set up a workflow for the [frontend][ghost-theme-repo] of this blog that would trigger the deployment whenever a change was merged in main. This is what I orginally tried to accomplish it:

```yaml
name: Deploy Theme
on:
  push:
    branches:
      - main
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy Ghost Theme
        uses: TryGhost/action-deploy-theme@v1.5.0
        with:
          api-url: ${{ secrets.GHOST_ADMIN_API_URL }}
          api-key: ${{ secrets.GHOST_ADMIN_API_KEY }}
```

The keys were stored in repository secrets which are accessible globally within the repository. However as I soon realized this is not the best approach for multiple reasons.

Firstly, a project may have more than one environment such as staging and production each with their own servers and access keys. It'd be nice to have a way to group keys meant for a particular environment.

Secondly it's a security risk which I want to emphasize here. With the above workflow in place, I was trying out a couple of things on a new branch when I noticed I could just add my current branch name into the list and the deploy job would trigger without that branch having ever been reviewed or merged in main. It's possible that one might, by mistake or ill intentions, enable the deployment job on their branch, which could break the staging or prod environment, or [log unmasked secrets][github-secrets-unmasked]. So, this is definitely a risk we want to avoid.

One approach to solve both problems here is to make use of Github environments. The official docs contain detailed explanation with sample scripts but as an example this is how I used it:

1. From repository Settings, create a production environment.
2. Choose Selected Branches in Deployment Branches dropdown and add main in the pattern
3. Add the api keys in production environment secrets
4. Update the workflow yml to add environment information

```yaml
name: Deploy Theme
on:
  push:
    branches:
      - main
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v2
      - name: Deploy Ghost Theme
        uses: TryGhost/action-deploy-theme@v1.5.0
        with:
          api-url: ${{ secrets.GHOST_ADMIN_API_URL }}
          api-key: ${{ secrets.GHOST_ADMIN_API_KEY }}
```

The line **environment: production** indicates that the secrets have to be read from the production environment. If the branch on which this job runs doesn't match the pattern provided in **Selected Branches** then the job will immediately fail with an error. That won't bother us here because we've specified it to run only on **main**. But if someone modifies it to include their branch as well, the job will simply throw an error!

[ghost]: https://ghost.org/
[ghost-theme-repo]: https://github.com/nikhils98/journal-minimalist
[github-secrets-unmasked]: https://stackoverflow.com/questions/63003669/how-can-i-see-my-git-secrets-unencrypted
