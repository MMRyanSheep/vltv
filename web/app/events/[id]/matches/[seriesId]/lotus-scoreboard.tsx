import { AgentAvatar } from "@/components/presentation";
import { agent } from "@/lib/catalog";

// Keep the screenshot order for the finals opener.
const results = [
  { agentId: "add6443a-41bd-e414-f6ad-e58d267f4e95", kda: "24/13/4" }, // Jett
  { agentId: "1dbf2edd-4729-0984-3115-daa5eed44993", kda: "23/21/8" }, // Clove
  { agentId: "22697a3d-45bf-8dd7-4fec-84a9e28c69d7", kda: "21/14/4" }, // Chamber
  { agentId: "8e253930-4c05-31dd-1b6c-968525494517", kda: "19/14/8" }, // Omen
  { agentId: "bb2a4828-46eb-8cd1-e765-15848195d751", kda: "16/14/7" }, // Neon
  { agentId: "df1cb487-4902-002e-5c17-d28e83e78588", kda: "15/17/1" }, // Waylay
  { agentId: "bb2a4828-46eb-8cd1-e765-15848195d751", kda: "14/19/5" }, // Neon
  { agentId: "dade69b4-4f5a-8528-247b-219e5a1facd6", kda: "10/16/4" }, // Fade
  { agentId: "dade69b4-4f5a-8528-247b-219e5a1facd6", kda: "9/12/8" }, // Fade
  { agentId: "22697a3d-45bf-8dd7-4fec-84a9e28c69d7", kda: "5/16/2" }, // Chamber
];

export function LotusScoreboard() {
  return <section className="panel scoreboard series-kda">
    <table aria-label="莲华古城战绩">
      <thead><tr><th scope="col">英雄</th><th scope="col" title="击杀 / 阵亡 / 助攻">KDA</th></tr></thead>
      <tbody>
        {results.map(({ agentId, kda }) => <tr key={`${agentId}-${kda}`}>
          <th scope="row"><span className="series-kda-agent">
            <AgentAvatar id={agentId} />{agent(agentId).name}
          </span></th>
          <td>{kda}</td>
        </tr>)}
      </tbody>
    </table>
  </section>;
}
