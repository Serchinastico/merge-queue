# MergeQueue Github Action

Merge your Pull Requests in a safe way.

Have you ever merged a branch that made all tests fail? Even if they were all green before merging? This is called "[Semantic Conflicts](https://bors.tech/essay/2017/02/02/pitch/)".

This happens because we merge outdated branches. To solve it, one can block Pull Requests merges from branches that are not up-to-date. However, this quickly evolves into a race between all developers where people will update their branches and be the first to merge, making others force their updates again. This wastes precious CI time and grows resentment within the members of the team.

This is why MergeQueue exists. MergeQueue is a Github action that will merge stuff for you in a smart way. Whenever you want to merge a Pull Request, just add your `ready-to-merge` label to it. MergeQueue will put your Pull Request in _the queue_ and merge it soon as possible. MergeQueue is capable of:

- Merge your Pull Requests.
- Update outdated branches only when necessary.
- Report errors if your branch has conflicts.
- Wait for a short time if you add the `ready-to-merge` to a PR by mistake.

## Using this action

First things first, this action requires a Github token that will fire other actions. According to [Github docs](https://docs.github.com/en/free-pro-team@latest/actions/reference/events-that-trigger-workflows#triggering-new-workflows-using-a-personal-access-token), this can't be achieved using the default Github token. Instead you will need to use a [personal access token](https://docs.github.com/en/free-pro-team@latest/github/authenticating-to-github/creating-a-personal-access-token). So make sure you have one before configuring MergeQueue.

MergeQueue has to be configured in two different workflows to ensure it works as expected.

### When merging branches into your base branch

Add the following workflow to your project:

```yaml
name: 'Main branch CI'
on:
  push:
    # This should be your base branch
    branches:
      - main

jobs:
  merge-queue:
    runs-on: ubuntu-latest
    steps:
      - name: MergeQueue
        uses: serchinastico@mergequeue
        with:
          # Your Github token goes here
          github-token: ${{ secrets.MERGE_QUEUE_GH_TOKEN }}
```

This workflow makes sure to fire the next Pull Request in the queue after a successful merge into your base branch.

### When a Pull Request changes its state

Add the following workflow to your project:

```yaml
name: 'Pull Request CI'
on:
  pull_request:
    # Default types are opened, synchronize and reopened
    # Make sure to add labeled as well to fire MergeQueue when adding a label
    types: [opened, labeled, synchronize, reopened]

jobs:
  # Your regular CI steps...
  sleep:
    runs-on: ubuntu-latest
    steps:
      - name: Sleep for 30 seconds
        uses: jakejarvis/wait-action@master
        with:
          time: '30s'
  # Last one is MergeQueue that will try to merge this PR
  merge-queue:
    runs-on: ubuntu-latest
    needs: [sleep]
    steps:
      - name: MergeQueue
        uses: serchinastico@mergequeue
        with:
          github-token: ${{ secrets.MERGE_QUEUE_GH_TOKEN }}
```

## Options

This is the list of options that MergeQueue supports:

| option           | required |      deafult      | description                                                                                                      |
| ---------------- | :------: | :---------------: | ---------------------------------------------------------------------------------------------------------------- |
| **github-token** |    ✅    |                   | Github token used to apply changes to the Pull Request                                                           |
| **base-branch**  |    ❌    |      `main`       | Name of the default branch where the bot should merge Pull Requests                                              |
| **merge-method** |    ❌    |     `squash`      | Method used to merge a Pull Request, possible values are: merge, rebase or squash                                |
| **grace-time**   |    ❌    |        `0`        | Time (in ms) this script waits before even start. This gives some time for contributors to remove a wrong label  |
| **merge-label**  |    ❌    | `ready-to-merge`  | Name of the label used to tag PRs as ready-to-merge                                                              |
| **block-label**  |    ❌    |  `do-not-merge`   | Name of the label used to block merges. If this option is present, MergeQueue will never merge this Pull Request |
| **error-label**  |    ❌    | `unable-to-merge` | Name of the label used to notify that MergeBot can't merge a Pull Request                                        |
