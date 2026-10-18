<?php
declare(strict_types=1);

/** Cierre manual: los registros permanecen asociados a su campaña. */
trait VentasCiclos
{
    /**
     * Métodos que proporciona la clase Ventas y sus otros traits.
     * Las firmas hacen explícitas las dependencias para el editor
     * (Intelephense) sin cambiar la lógica del cierre de campañas.
     */
    abstract private static function db(): PDO;
    abstract private static function auth(): array;
    abstract private static function campaign(PDO $db, int $id, bool $forUpdate = false): array;
    abstract private static function fetchOne(PDO $db, string $sql, array $params = []): ?array;
    abstract private static function calcularPlanilla(PDO $db, int $campaignId, string $type, ?int $year, ?int $division): array;

    public static function cerrarCampania(): never
    {
        $db=self::db();$auth=self::auth();$body=request_body();
        $id=positive_id($body['id_campania'] ?? null,'campaña');
        $result=transaction($db,static function()use($db,$auth,$id){
            $before=self::campaign($db,$id,true);
            if ($before['estado_cierre']==='cerrada') api_error('Esta campaña ya está cerrada.','VENTA_CAMPANIA_CERRADA',409);
            if ($before['fecha_fin'] && $before['fecha_fin'] >= date('Y-m-d')) {
                api_error('Podés cerrar esta campaña desde el día posterior a su fecha de fin.', 'VENTA_CAMPANIA_AUN_VIGENTE',409);
            }
            // La transacción bloquea la campaña, también usada por guardarOrden().
            $pending=(int)self::fetchOne($db,"SELECT COUNT(*) n FROM ventas_ordenes WHERE id_campania=? AND estado='pendiente'",[$id])['n'];
            $unretired=(int)self::fetchOne($db,"SELECT COUNT(*) n FROM ventas_ordenes WHERE id_campania=? AND estado='aprobada' AND retirado=0",[$id])['n'];
            $insert=$db->prepare('INSERT INTO ventas_planillas_cerradas(id_campania,tipo,datos) VALUES (?,?,?)');
            foreach(['cursos','docentes'] as $type) {
                // Congelamos el padrón, la asignación de ventas, los montos y las
                // estadísticas de la planilla; filtros posteriores son locales al JSON.
                $data=self::calcularPlanilla($db,$id,$type,null,null);
                $data['campania']['estado_cierre']='cerrada';
                $json=json_encode($data,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
                $insert->execute([$id,$type,$json]);
            }
            $db->prepare("UPDATE ventas_campanias SET estado_cierre='cerrada',cerrada_en=NOW(),activo=0,visible_menu=0 WHERE id_campania=?")->execute([$id]);
            $after=self::campaign($db,$id);
            audit_change($db,$auth,'VENTAS','CERRAR_CAMPANIA','ventas_campanias',$id,'Campaña cerrada con planillas históricas congeladas.',$before,$after);
            return ['cobros_pendientes'=>$pending,'retiros_pendientes'=>$unretired,'cerrada_en'=>$after['cerrada_en']];
        });
        api_success($result,'Campaña cerrada; historial y planillas conservados sin modificar contabilidad ni stock.');
    }
}
