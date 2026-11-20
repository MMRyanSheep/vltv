use parquet::record::Row;

use crate::tables::{Column, Stamp};

#[derive(Default)]
pub(crate) struct DamageEvidence {
    current: Option<DamageRpc>,
    pub hits: Vec<DamageHit>,
}

struct DamageRpc {
    stamp: Stamp,
    packet: i64,
    actor: u32,
    point_damage: bool,
    amount: Option<f64>,
    damager: Option<u32>,
    kill_credit: Option<u32>,
    victim: Option<u32>,
    respawn: Option<u32>,
    life_change_index: Option<u32>,
    lethal: Option<bool>,
}

pub(crate) struct DamageHit {
    pub stamp: Stamp,
    pub victim: u32,
    pub damager: u32,
    pub kill_credit: u32,
    pub respawn: u32,
    pub life_change_index: u32,
    pub amount: f64,
    pub lethal: bool,
}

impl DamageEvidence {
    pub fn field(&mut self, stamp: Stamp, actor: u32, name: &str, row: &Row) {
        let Some((rpc, field)) = name.split_once('.') else {
            return;
        };
        let point_damage = match rpc {
            "MulticastNotifyDamage_Base" => false,
            "MulticastNotifyDamage_Point" => true,
            _ => return,
        };
        let Some(packet) = row.integer("packet_id") else {
            return;
        };
        // vrfkit emits the fields of each RPC in sequence, starting with DamageTaken.
        if field == "DamageTaken" {
            self.finish_rpc();
            self.current = Some(DamageRpc {
                stamp,
                packet,
                actor,
                point_damage,
                amount: row
                    .double("value_f64")
                    .filter(|n| n.is_finite() && *n > 0.0),
                damager: None,
                kill_credit: None,
                victim: None,
                respawn: None,
                life_change_index: None,
                lethal: None,
            });
            return;
        }
        let Some(hit) = &mut self.current else {
            return;
        };
        if (packet, actor, point_damage) != (hit.packet, hit.actor, hit.point_damage) {
            return;
        }
        match field {
            "DamagerPlayerState" => hit.damager = row.u32("value_i64"),
            "KillCreditPlayerState" => hit.kill_credit = row.u32("value_i64"),
            "Character" => hit.victim = row.u32("value_i64"),
            "VictimRespawnNumber" => hit.respawn = row.u32("value_i64"),
            "LifeChangeEventIndex" => hit.life_change_index = row.u32("value_i64"),
            "bDamageKilledTarget" => hit.lethal = row.boolean("value_bool"),
            _ => {}
        }
    }

    pub fn finish(&mut self) {
        self.finish_rpc();
        self.hits.sort_unstable_by_key(|hit| hit.stamp);
    }

    fn finish_rpc(&mut self) {
        let Some(hit) = self.current.take() else {
            return;
        };
        if let (
            Some(victim),
            Some(damager),
            Some(kill_credit),
            Some(respawn),
            Some(life_change_index),
            Some(amount),
            Some(lethal),
        ) = (
            hit.victim,
            hit.damager,
            hit.kill_credit,
            hit.respawn,
            hit.life_change_index,
            hit.amount,
            hit.lethal,
        ) {
            self.hits.push(DamageHit {
                stamp: hit.stamp,
                victim,
                damager,
                kill_credit,
                respawn,
                life_change_index,
                amount,
                lethal,
            });
        }
    }
}
