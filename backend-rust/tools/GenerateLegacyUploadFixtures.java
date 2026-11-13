// Fixture-only replay of the compiled Scala DTO formats and controller's DTO adaptation.
import java.nio.file.*;
import java.util.*;
import play.api.libs.json.*;
import com.scalableminds.util.tools.JsonAutoFormat;
import com.scalableminds.webknossos.datastore.controllers.*;
import com.scalableminds.webknossos.datastore.services.uploading.*;
public class GenerateLegacyUploadFixtures {
    static final String ID = "0123456789abcdef01234567";
    static String record(String name, String kind, String input, JsonAutoFormat format) {
        var parsed = Json.parse(input); var result = format.reads(parsed);
        var prefix = "{\"name\":\""+name+"\",\"kind\":\""+kind+"\",\"input\":"+parsed;
        if (result instanceof JsError) return prefix+",\"error\":"+JsError$.MODULE$.toJson((JsError)result)+"}";
        Object value = result.get(); JsValue adapted;
        if (value instanceof LegacyReserveManualUploadInformation info) {
            var request = new DatasetUploadInfo(new ResumableUploadInfo("aManualUpload",0,scala.Option.apply(scala.collection.immutable.List$.MODULE$.empty()),scala.Option.empty()),info.datasetName(),info.organization(),scala.Option.empty(),info.initialTeamIds(),info.folderId(),scala.Option.apply(info.requireUniqueName()),scala.Option.apply(false),scala.Option.empty(),scala.Option.empty(),scala.Option.empty());
            adapted = DatasetUploadInfo$.MODULE$.derived$JsonAutoFormat().writes(request);
        } else if (value instanceof ReserveUploadInformationV13 info) {
            var request = new DatasetUploadInfo(new ResumableUploadInfo(info.uploadId(),info.totalFileCount(),(scala.Option)info.filePaths(),info.totalFileSizeInBytes()),info.name(),info.organization(),(scala.Option)info.layersToLink(),info.initialTeams(),info.folderId(),info.requireUniqueName(),info.isVirtual(),scala.Option.empty(),scala.Option.empty(),scala.Option.empty());
            adapted = DatasetUploadInfo$.MODULE$.derived$JsonAutoFormat().writes(request);
        } else if (value instanceof LegacyReserveUploadInformationV11 info) {
            var linked = new ArrayList<LinkedLayerIdentifier>();
            for (var oldObject : scala.jdk.javaapi.CollectionConverters.asJava(info.layersToLink().getOrElse(() -> scala.collection.immutable.List$.MODULE$.empty()))) {
                var old = (LegacyLinkedLayerIdentifier)oldObject;
                com.scalableminds.util.objectid.ObjectId id = com.scalableminds.util.objectid.ObjectId$.MODULE$.fromStringSync(old.dataSetName()).getOrElse(() -> com.scalableminds.util.objectid.ObjectId$.MODULE$.fromStringSync(ID).get());
                linked.add(new LinkedLayerIdentifier(id,old.layerName(),old.newLayerName()));
            }
            var request = new DatasetUploadInfo(new ResumableUploadInfo(info.uploadId(),info.totalFileCount(),(scala.Option)info.filePaths(),info.totalFileSizeInBytes()),info.name(),info.organization(),scala.Option.apply(scala.jdk.javaapi.CollectionConverters.asScala(linked).toList()),info.initialTeams(),info.folderId(),info.requireUniqueName(),info.isVirtual(),scala.Option.empty(),scala.Option.empty(),scala.Option.empty());
            adapted = DatasetUploadInfo$.MODULE$.derived$JsonAutoFormat().writes(request);
        } else adapted = (JsValue)format.writes(value);
        return prefix+",\"normalized\":"+format.writes(value)+",\"adapted\":"+adapted+"}";
    }
    public static void main(String[] args) throws Exception {
        String basic = "{\"uploadId\":\"old\",\"name\":\"legacy\",\"organization\":\"org\",\"totalFileCount\":1,\"initialTeams\":[],\"needsConversion\":true}";
        var cases = new ArrayList<String>();
        var v13 = ReserveUploadInformationV13$.MODULE$.derived$JsonAutoFormat();
        var v11 = LegacyReserveUploadInformationV11$.MODULE$.derived$JsonAutoFormat();
        var manual = LegacyReserveManualUploadInformation$.MODULE$.derived$JsonAutoFormat();
        var finish = LegacyUploadInformation$.MODULE$.derived$JsonAutoFormat();
        cases.add(record("v13_basic","v13",basic,v13));
        cases.add(record("v11_basic","v11",basic,v11));
        cases.add(record("v13_nulls","v13",basic.replace("\"needsConversion\":true", "\"needsConversion\":null,\"filePaths\":null,\"layersToLink\":null,\"folderId\":null"),v13));
        cases.add(record("v13_options","v13",basic.replace("\"initialTeams\":[]", "\"initialTeams\":[\""+ID+"\"],\"folderId\":\""+ID+"\",\"requireUniqueName\":true,\"isVirtual\":false,\"filePaths\":[\"a\"],\"totalFileSizeInBytes\":99,\"layersToLink\":[{\"datasetId\":\""+ID+"\",\"layerName\":\"a\",\"newLayerName\":\"b\"}]"),v13));
        cases.add(record("v11_links","v11",basic.replace("\"initialTeams\":[]", "\"initialTeams\":[],\"layersToLink\":[{\"organizationName\":\"old_org\",\"dataSetName\":\"directory\",\"layerName\":\"a\"},{\"dataSetName\":\""+ID+"\",\"layerName\":\"b\",\"newLayerName\":\"c\"}]"),v11));
        cases.add(record("manual_default","manual","{\"datasetName\":\"manual\",\"organization\":\"org\",\"initialTeamIds\":[]}",manual));
        cases.add(record("finish_ignored","finish","{\"uploadId\":\"old\",\"needsConversion\":true,\"ignored\":1}",finish));
        cases.add(record("v13_missing","v13","{}",v13));
        cases.add(record("v11_invalid","v11",basic.replace("\"initialTeams\":[]", "\"initialTeams\":[\"bad\"],\"layersToLink\":[{\"layerName\":2}]"),v11));
        cases.add(record("finish_wrong","finish","{\"uploadId\":2,\"needsConversion\":\"true\"}",finish));
        System.out.println("[\n"+String.join(",\n",cases)+"\n]");
    }
}
