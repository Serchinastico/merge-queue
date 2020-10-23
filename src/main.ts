import * as core from '@actions/core'
import * as github from '@actions/github'

async function run(): Promise<void> {
  try {
    const context = github.context

    console.log(`Action: ${context.payload.action}`)
    console.log(`Event name: ${context.eventName}`)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
