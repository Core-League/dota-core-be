---
name: code-reviewer
description:
  Use this skill to review code. It supports both local changes (staged or working tree)
  and remote Pull Requests (by ID or URL). It focuses on correctness, maintainability,
  and adherence to project standards. Uses Azure DevOps for remote PRs.
---

# Code Reviewer

This skill guides the agent in conducting professional and thorough code reviews for both local development and remote Pull Requests hosted on Azure DevOps.

## Workflow

### 1. Determine Review Target
*   **Remote PR**: If the user provides a PR number or URL (e.g., "Review PR #123"), target that remote PR on Azure DevOps.
*   **Local Changes / "Review my changes"**: Target the current local file system state.

### 2. Preparation

#### For Remote PRs:
1.  **Fetch PR Details**: Use the Azure DevOps MCP tools to retrieve the PR information.
    *   Use `mcp__azure-devops__repo_get_pull_request_by_id` to get the PR details (title, description, source/target branches).
    *   Use `mcp__azure-devops__repo_list_pull_request_threads` and `mcp__azure-devops__repo_list_pull_request_thread_comments` to read existing review comments.
2.  **Checkout**: Fetch and checkout the PR branch locally.
    ```bash
    git fetch origin <source-branch>
    git checkout <source-branch>
    ```
3.  **Context**: Read the PR description and any existing thread comments to understand the goal and history.

#### For Local Changes:
1.  **Check staged/unstaged changes first**:
    *   `git status` to see what's modified.
    *   `git diff --staged` for staged changes.
    *   `git diff` for unstaged changes.
2.  **If no staged/unstaged changes found**, fall back to recent commits:
    *   `git log main..HEAD --oneline -20` to list up to 20 commits on the branch.
    *   **Identify the work item number** from commit messages (e.g., `14777:` or `#14777`). Commits in this project are grouped by work item number.
    *   **Filter to related commits only**: From the listed commits, select only those whose messages reference the same work item number. Use `git log --all-match --grep='<work-item-number>' main..HEAD --oneline` to isolate them.
    *   `git diff` only the range covered by the related commits (from the parent of the oldest related commit to the newest): `git diff <oldest-related-commit>^..<newest-related-commit>`.
    *   **Review all 20 listed commits** to identify the work item grouping — do NOT skip any of the 20.
    *   Never load more than 20 commits. If the branch has more, review only the most recent 20.

### 3. Check Linked Work Items
Before analyzing code, the agent MUST check for linked Azure DevOps work items:
1.  Look at commit messages for work item references (e.g., `#14777`, `15269`).
2.  For each referenced work item, use `mcp__azure-devops__wit_get_work_item` (with `expand: "all"`) to fetch full details including description, acceptance criteria, and comments.
3.  Use the work item context to understand the intent behind the changes and verify that the implementation matches the requirements.
4.  Flag any requirements from the work item that appear unaddressed or only partially implemented.

### 4. In-Depth Analysis
Analyze the code changes based on the following pillars:

*   **Correctness**: Does the code achieve its stated purpose without bugs or logical errors?
*   **Maintainability**: Is the code clean, well-structured, and easy to understand and modify in the future? Consider factors like code clarity, modularity, and adherence to established design patterns.
*   **Readability**: Is the code well-commented (where necessary) and consistently formatted according to the project's coding style guidelines?
*   **Efficiency**: Are there any obvious performance bottlenecks or resource inefficiencies introduced by the changes?
*   **Security**: Are there any potential security vulnerabilities or insecure coding practices?
*   **Edge Cases and Error Handling**: Does the code appropriately handle edge cases and potential errors?
*   **Testability**: Is the new or modified code adequately covered by tests? Suggest additional test cases that would improve coverage or robustness.

### 5. Provide Feedback

#### Structure
*   **Summary**: A high-level overview of the review.
*   **Findings**:
    *   **Critical**: Bugs, security issues, or breaking changes.
    *   **Improvements**: Suggestions for better code quality or performance.
    *   **Nitpicks**: Formatting or minor style issues (optional).
*   **Conclusion**: Clear recommendation (Approved / Request Changes).

#### Tone
*   Be constructive, professional, and friendly.
*   Explain *why* a change is requested.
*   For approvals, acknowledge the specific value of the contribution.

### 6. Post-Review Actions (Remote PRs only)
*   Offer to post review comments back to the Azure DevOps PR using `mcp__azure-devops__repo_create_pull_request_thread`.
*   Ask the user if they want to switch back to the default branch (e.g., `main` or `dev`).
