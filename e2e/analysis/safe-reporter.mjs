import { writeFileSync } from 'node:fs'
export default class Reporter {
  results = []
  onTestEnd(test, result) {
    const row = {title:test.title,status:result.status,duration_ms:result.duration,errors:result.errors.length}
    this.results.push(row)
    console.log(`${result.status}: ${test.title}`)
  }
  onEnd(result) {
    const output = {overall:result.status,tests:this.results}
    writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/targeted-results.json',JSON.stringify(output,null,2))
    console.log(`Total ${this.results.length}; outcome ${result.status}; details redacted`)
  }
}
