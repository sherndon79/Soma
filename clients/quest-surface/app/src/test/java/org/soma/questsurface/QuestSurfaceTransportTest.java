package org.soma.questsurface;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.security.cert.CertificateException;

import javax.net.ssl.SSLHandshakeException;

import org.junit.Test;

public final class QuestSurfaceTransportTest {
    @Test
    public void diagnosticPreservesBoundedTopAndRootReasonClasses() {
        SSLHandshakeException handshake = new SSLHandshakeException("handshake failed");
        handshake.initCause(new CertificateException(
                "Trust anchor for certification path not found: CN=Soma Development CA"));

        assertEquals("SSLHandshakeException", QuestSurfaceTransport.diagnosticTopClass(handshake));
        assertEquals("CertificateException", QuestSurfaceTransport.diagnosticRootClass(handshake));
        assertEquals(
                "Trust_anchor_for_certification_path_not_found__CN_Soma_Development_CA",
                QuestSurfaceTransport.diagnosticRootCode(handshake));
    }

    @Test
    public void diagnosticNeverEmitsAnUnboundedOrEmptyReason() {
        SSLHandshakeException longFailure = new SSLHandshakeException("x".repeat(200));
        assertEquals(96, QuestSurfaceTransport.diagnosticRootCode(longFailure).length());

        SSLHandshakeException emptyFailure = new SSLHandshakeException("");
        assertEquals("unspecified", QuestSurfaceTransport.diagnosticRootCode(emptyFailure));
        assertTrue(QuestSurfaceTransport.diagnosticRootCode(null).length() <= 96);
    }
}
